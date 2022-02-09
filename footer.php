<?php
/**
 * The template for displaying the footer
 *
 * Contains the closing of the #content div and all content after.
 *
 * @link https://developer.wordpress.org/themes/basics/template-files/#template-partials
 *
 * @package Restly
 */
if(is_page() || is_singular('post') || is_singular('restly_portfolio') || is_singular('restly_team') && get_post_meta(get_the_ID(), 'restly_metabox', true)) {
	$restlyMeta = get_post_meta(get_the_ID(), 'restly_metabox', true);
} else {
	$restlyMeta = array();
}
$restly_footer_styles = restly_options('restly_footer_styles');
if (is_array($restlyMeta) && array_key_exists('restly_meta_footer_styles', $restlyMeta) && array_key_exists('restly_meta_footer_style_shwo', $restlyMeta) && $restlyMeta['restly_meta_footer_style_shwo'] == true && get_post_meta(get_the_ID(), 'restly_metabox', true) ) {
	$selectedFooter = $restlyMeta['restly_meta_footer_styles'];
}elseif (!empty($restly_footer_styles) && class_exists( 'CSF' )) {
	$selectedFooter = restly_options('restly_footer_styles');
}else {
	$selectedFooter = 'one';
} 
if ( is_active_sidebar( 'footer-1') || class_exists( 'CSF' ) ){
	$active_widgets = 'widget-yes';
}else{
	$active_widgets ='widget-no';
}
?>
	<footer id="colophon" class="site-footer footer-<?php echo esc_attr($selectedFooter); ?>">
		<div class="footer-widgets-area <?php echo esc_attr($active_widgets); ?>">
			<?php 
			if($selectedFooter == 'two'){
				get_template_part('inc/footer/footer','top');
			}elseif($selectedFooter == 'three'){
				echo '<div class="footer-top-area"></div>';
			}
			get_template_part('inc/footer/footer','widgets');
			if($selectedFooter !== 'one' ){
				get_template_part('inc/footer/copyright');
			} ?>
		</div>
		<?php if($selectedFooter == 'one' ){
			get_template_part('inc/footer/copyright');
		} ?>
	</footer><!-- #colophon -->
	<div class="to-top" id="back-top"><i class="fa fa-angle-up"></i></div>
</div><!-- #page -->
<?php wp_footer(); ?>
</body>
</html>