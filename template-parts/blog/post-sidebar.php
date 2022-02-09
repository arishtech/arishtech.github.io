<?php
/**
 * Template part for displaying posts sidebar layout
 *
 * @package restly
 */

if(is_archive()){
	$restly_pageLayout = restly_options('restly_archive_layout', 'right-sidebar');
}else if(is_search()){
	$restly_pageLayout = restly_options('restly_search_layout', 'right-sidebar');
}else{
	$restly_pageLayout = restly_options('restly_blog_layout', 'right-sidebar');
}

if($restly_pageLayout == 'left-sidebar' && is_active_sidebar('sidebar') || $restly_pageLayout == 'grid-ls' && is_active_sidebar('sidebar') || $restly_pageLayout == 'right-sidebar' && is_active_sidebar('sidebar') || $restly_pageLayout == 'grid-rs' && is_active_sidebar('sidebar')){
	$pageColumnClass = 'col-12 col-sm-12 col-md-12 col-lg-7 col-xl-8';
}else{
	$pageColumnClass = 'col-12 col-sm-12 col-md-12 col-lg-12';
}
?>
<div class="row blog-page-with-sidebar">
	<?php
	if($restly_pageLayout == 'left-sidebar' && is_active_sidebar('sidebar') || $restly_pageLayout == 'grid-ls' && is_active_sidebar('sidebar')){
		get_sidebar();
	}
	?>
	<div class="<?php echo esc_attr($pageColumnClass);?>">
        <div class="row all-posts-wrapper">
            <?php
            if ( have_posts() ) :

                if ( is_home() && ! is_front_page() ) :
                    ?>
                    <header>
                        <h1 class="page-title screen-reader-text"><?php single_post_title(); ?></h1>
                    </header>
                <?php
                endif;
                /* Start the Loop */
                while ( have_posts() ) :
                    the_post(); ?>
                        <?php get_template_part( 'template-parts/blog/post-sidebar-item', get_post_format() ); ?>
                <?php
                endwhile;
            else :
                get_template_part( 'template-parts/content', 'none' );
            endif;
            ?>
        </div>
        <?php 
        $restly_pagination = restly_options('restly_show_pagination', true );
            if($restly_pagination == true ){
                restly_pagination();
            };
        ?>
	</div>
	<?php
	if($restly_pageLayout == 'right-sidebar' && is_active_sidebar('sidebar') || $restly_pageLayout == 'grid-rs' && is_active_sidebar('sidebar')){
		get_sidebar();
	}
	?>

</div>