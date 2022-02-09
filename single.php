<?php
/**
 * The template for displaying all single posts
 *
 * @link https://developer.wordpress.org/themes/basics/template-hierarchy/#single-post
 *
 * @package Restly
 */

get_header();
if(get_post_meta( get_the_ID(), 'restly_metabox', true)) {
    $restly_commonMeta = get_post_meta( get_the_ID(), 'restly_metabox', true );
}else{
    $restly_commonMeta = array();
}
if(array_key_exists('restly_layout_meta', $restly_commonMeta) && !empty($restly_commonMeta['restly_layout_meta'])){
    $restly_postLayout = $restly_commonMeta['restly_layout_meta'];
}else{
    $restly_postLayout = 'right-sidebar';
}
if(is_array($restly_commonMeta) && array_key_exists('restly_sidebar_meta', $restly_commonMeta)){
    $restly_selectedSidebar = $restly_commonMeta['restly_sidebar_meta'];
}else{
    $restly_selectedSidebar = 'sidebar';
}
if($restly_postLayout == 'left-sidebar' && is_active_sidebar($restly_selectedSidebar) || $restly_postLayout == 'right-sidebar' && is_active_sidebar($restly_selectedSidebar)){
    $restly_pageColumnClass = 'col-12 col-sm-12 col-md-12 col-lg-7 col-xl-8';
}else{
    $restly_pageColumnClass = 'col-12 col-sm-12 col-md-12 col-lg-12 col-xl-12';
}
if(array_key_exists('restly_meta_enable_banner', $restly_commonMeta)){
    $restly_postBanner = $restly_commonMeta['restly_meta_enable_banner'];
}else{
    $restly_postBanner = true;
}
if($restly_postLayout == 'full-width'){
	$restly_sidebar_bg = 'sidebar-no-bg-main';
}else{
	$restly_sidebar_bg = 'sidebar-bg-main';
}
?>
	<?php if($restly_postBanner == true ) : ?>
	<div class="breadcroumb-area">
		<div class="container">
			<div class="breadcroumn-contnt">
				<h2><?php the_title(); ?></h2>
				<div class="bre-sub">
				<?php if(function_exists('bcn_display')){
					bcn_display();
				}?>
				</div>
			</div>
		</div>
	</div>
	<?php endif; ?>
	<main id="primary" class="site-main content-area <?php echo esc_attr($restly_sidebar_bg); ?>">
		<div class="container">
			<div class="page-layout  <?php echo esc_attr($restly_postLayout); ?>">
				<div class="row">
					<?php
					if($restly_postLayout == 'left-sidebar' && is_active_sidebar($restly_selectedSidebar)){
						get_sidebar();
					}
					?>
					<div class="<?php echo esc_attr($restly_pageColumnClass); ?>">
						<div class="all-posts-wrapper">
						<?php
							while ( have_posts() ) :
								the_post();

								get_template_part( 'template-parts/content', get_post_type() );
								restly_next_prev_post_link();

								// If comments are open or we have at least one comment, load up the comment template.
								if ( comments_open() || get_comments_number() ) :
									comments_template();
								endif;
							endwhile; // End of the loop.
							?>
						</div>
					</div>
					<?php
			if($restly_postLayout == 'right-sidebar' && is_active_sidebar($restly_selectedSidebar)){
				get_sidebar();
			}?>
				</div>
			
			</div>
		</div>
	</main><!-- #main -->
<?php
get_footer();
