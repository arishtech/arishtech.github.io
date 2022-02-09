<?php 
$restly_post_author = restly_options('restly_post_author', true);
$restly_post_date = restly_options('restly_post_date', true);
$restly_cmnt_number = restly_options('restly_cmnt_number', true);
$restly_show_category = restly_options('restly_show_category', true);
$restly_share_blog = restly_options('restly_share_blog', false);
if( has_post_thumbnail() or has_post_format( 'video' ,get_the_ID()) or has_post_format( 'audio' ,get_the_ID())){
    $restly_thum_class = 'with-thum-img';
}else{
    $restly_thum_class = 'no-thum-img';
}
$code = 'iframe';
if(get_post_meta( get_the_ID(), 'restly_postmeta_video', true)) {
	$restly_postvideo = get_post_meta( get_the_ID(), 'restly_postmeta_video', true );
}else {
  $restly_postvideo = array();
}
if(get_post_meta( get_the_ID(), 'restly_postmeta_audio', true)) {
	$restly_postaudio = get_post_meta( get_the_ID(), 'restly_postmeta_audio', true );
}else {
  $restly_postaudio = array();
}
if(get_post_meta( get_the_ID(), 'restly_postmeta_gallery', true)) {
	$restly_postgallery = get_post_meta( get_the_ID(), 'restly_postmeta_gallery', true );
    $restly_postgallerys = $restly_postgallery['restly_post_gallery']; // for eg. 15,50,70,125
    $restly_gallery_ids = explode( ',', $restly_postgallerys );
}else {
  $restly_postgallery = array();
}
?>
<div class="col-lg-4 col-md-12 grid-post-item single-post-item">
    <div id="post-<?php the_ID(); ?>" <?php post_class('post-single'); ?>>
        <?php 
        if(has_post_format( 'video' ,get_the_ID()) && has_post_thumbnail() ){
            ?>
            <div class="post-img">
                <?php the_post_thumbnail('restly-blog-full', array('class' => 'img-responsive')); ?>
                
                <a href="<?php echo esc_url($restly_postvideo['restly_post_video']); ?>" class="post-video video-popup"><i class="fas fa-play"></i></a>
            </div>
            <?php
        }elseif(has_post_format( 'video' , get_the_ID() ) && !empty($restly_postvideo['restly_post_video'])){
            ?>
            <div class="vendor">
                <<?php echo esc_attr($code); ?> width="100%" height="500" src="<?php echo esc_url($restly_postvideo['restly_post_video']); ?>"></<?php echo esc_attr($code); ?>>
            </div>
            <?php 
        }elseif(has_post_format( 'audio' , get_the_ID() ) && !empty($restly_postaudio['restly_post_audio'])){
            ?>
            <div class="vendor">
                <<?php echo esc_attr($code); ?> width="100%" height="400" src="<?php echo esc_url($restly_postaudio['restly_post_audio']); ?>"></<?php echo esc_attr($code); ?>>
            </div>
            <?php 
        }elseif(has_post_format( 'gallery' , get_the_ID() ) && !empty($restly_gallery_ids)){
            ?>
                <div class="post-gallerys">
                <?php 
                foreach( $restly_gallery_ids as $gallery_id ){
                    echo wp_get_attachment_image( $gallery_id, 'restly-blog-medium' );
                }
                ?>
                </div>
            <?php 
        }elseif(has_post_thumbnail()){
            ?>
            <div class="post-img">
                <?php the_post_thumbnail('restly-blog-medium'); ?>
        </div>
            <?php 
        }
        ?>
       <div class="post-contents <?php echo esc_attr($restly_thum_class); ?>">
            <div class="post-meta-box d-flex">
                <div class="post-meta-item flex-grow-1">
                    <ul>
                        <li><i class="fas fa-user-alt"></i><?php restly_posted_by(); ?></li>
                    </ul>
                </div>
                <?php if($restly_share_blog == true ) : ?>
                <div class="post-share">
                    <label><?php esc_html_e('Share Now','restly'); ?></label>
                    <?php if(function_exists('restly_post_share')){
                        restly_post_share();
                    } ?>
                </div>
                <?php endif; ?>
            </div>
            <div class="post-title">
                <?php the_title( '<h2 class="entry-title"><a href="' . esc_url( get_permalink() ) . '" rel="bookmark">', '</a></h2>' ); ?>
            </div>
            <div class="post-content">
            <p><?php echo wp_trim_words( get_the_content(), 40 ); ?></p>
            </div>
            <div class="post-button d-flex">
                <a href="<?php echo esc_url( get_permalink() ); ?>" class="theme-btns"><?php esc_html_e('Read More','restly'); ?></a>
            </div>
       </div>
    </div>
</div>